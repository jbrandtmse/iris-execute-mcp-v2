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
import { NPM_PUBLISH_ORDER, RELEASE_CHANNELS } from "../../../../scripts/lib/release-core.mjs";

export const SHA = "c".repeat(40);

// -- the fake GitHub API -------------------------------------------------------------------------------------------

/** The answer of one route: a status and a JSON body. */
export interface FakeAnswer {
  status: number;
  body?: unknown;
}

/** The state of the fake GitHub API. */
export interface FakeGithub {
  /** The environment, its deployment rules and the runs the API answers with; replace any to change the answer. */
  environment: FakeAnswer;
  policies: FakeAnswer;
  runs: () => FakeAnswer;
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

/** A fake GitHub API with a protected environment and one green CI run. */
export function newFakeGithub(): FakeGithub {
  return {
    environment: protectedEnvironment(),
    policies: TAG_POLICIES,
    runs: () => ({ status: 200, body: { total_count: 1, workflow_runs: [ciRun()] } }),
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
  return { status: 404, body: { message: "Not Found" } };
}

/** A `fetch` that answers from the fake API; any other host is refused, so no test reaches a network. */
export function fakeFetch(github: FakeGithub, extra: (url: string) => FakeAnswer | undefined = () => undefined): typeof fetch {
  return (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    const url = String(input);
    const other = extra(url);
    const answer = other ?? (url.startsWith("https://api.github.com") ? answerFor(github, url, init?.headers?.["Authorization"] ?? "") : { status: 599, body: { message: `no route for ${url}` } });
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status, headers: { "Content-Type": "application/json" } });
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

// -- synthetic artifacts -------------------------------------------------------------------------------------------

/** What {@link makeArtifacts} writes. */
export interface ArtifactOptions {
  version?: string;
  sha?: string;
  mode?: string;
  event?: string;
  ref?: string;
  publisher?: string;
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
 * Write synthetic artifacts into `dir` -- eight tarballs, a vsix and a small IPM tree -- and their `release-manifest.json` with the
 * real hashes. The tarballs are not archives; `publish` hands them to the stand-in `npm` and reads their bytes only for the hash.
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
  write("vsix/iris-mcp-launcher-0.1.0.vsix", "synthetic vsix\n");
  write("ipm/module.xml", "<Export/>\n");
  write("ipm/README.md", "# iris-execute-mcp-v2\n");
  write("ipm/src/cls/ExecuteMCPv2/Utils.cls", "Class ExecuteMCPv2.Utils {}\n");
  const vsix = { file: "vsix/iris-mcp-launcher-0.1.0.vsix", name: "iris-mcp-launcher", version: "0.1.0", publisher: options.publisher ?? "TBD-at-publish-time", files: ["package.json", "dist/extension.js"] };
  const details: Record<string, Record<string, unknown>> = {
    npm: { packages },
    "vscode-marketplace": vsix,
    "open-vsx": vsix,
    ipm: { tree: "ipm", module: "iris-execute-mcp-v2", version, marker: `${version}+2.244fe8623c76`, repository: "jbrandtmse/iris-execute-mcp-v2-ipm", branch: "master" },
  };
  const files = [
    ...packages.map((entry) => entry.tarball),
    "vsix/iris-mcp-launcher-0.1.0.vsix",
    "ipm/module.xml",
    "ipm/README.md",
    "ipm/src/cls/ExecuteMCPv2/Utils.cls",
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
  /** The semver of the bootstrap marker and of `ipm/module.xml` (default: the version of `@iris-mcp/shared`). */
  markerSemver?: string;
  moduleVersion?: string;
  /** Pending changesets, by file name. */
  pending?: string[];
  /** The root scripts (default: the four `:check` scripts, `format:check`, hooks and the others of the real root). */
  scripts?: Record<string, string>;
}

/** The root scripts of the real repository that matter to `prepare`. */
export const ROOT_SCRIPTS: Record<string, string> = {
  "gen:bootstrap": "node scripts/gen-bootstrap.mjs",
  "pregen:governance-baseline:check": "turbo run build --filter @iris-mcp/shared",
  "gen:governance-baseline:check": "node scripts/gen-governance-baseline.mjs --check",
  "gen:skills:check": "node scripts/gen-skills.mjs --check",
  "gen:pack:check": "node scripts/gen-pack.mjs --check",
  "gen:tools-list-snapshot:check": "node scripts/gen-tools-list-snapshot.mjs --check",
  "format:check": "prettier --check .",
  "check:provenance": "node scripts/check-provenance.mjs",
  "validate:prompts": "node scripts/validate-prompts.mjs",
  version: "node scripts/release-version.mjs",
  release: "node scripts/release.mjs",
};

/** The marker `prepare` reads from the embed. */
export const MARKER_TAIL = "2.244fe8623c76";

/** Write a synthetic repository under `root`: the eight packages, the changesets, the embed's marker line, `ipm/module.xml`, the extension and the LICENSE. */
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
  text("packages/shared/src/bootstrap-classes.ts", `export const BOOTSTRAP_VERSION = "${options.markerSemver ?? sharedVersion}+${MARKER_TAIL}";\n`);
  text("ipm/module.xml", `<Export><Module><Name>iris-execute-mcp-v2</Name><Version>${options.moduleVersion ?? sharedVersion}</Version></Module></Export>\n`);
  json("extensions/iris-mcp-launcher/package.json", { name: "iris-mcp-launcher", version: "0.1.0", publisher: "TBD-at-publish-time" });
  text("LICENSE", "MIT License\n");
  return { versionOf };
}
