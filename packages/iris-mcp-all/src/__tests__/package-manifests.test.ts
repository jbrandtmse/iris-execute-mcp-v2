/**
 * Story 42.1 (AC 42.1.1, AC 42.1.5; AD-28, AD-29, Rule #45, Rule #56) - the publish-readiness manifest checks.
 *
 * Every published manifest (the eight `packages/*` and the VS Code extension) is read from disk and checked for:
 *  - the Node floor: `engines.node` is one `>=22.x.y` value, equal to the root's, in every package;
 *  - `@types/node` at the floor's major, declared in every TypeScript package and in the extension;
 *  - the metadata a registry listing needs: license, repository (with the package's own directory), author, homepage,
 *    bugs and keywords;
 *  - the MCP Registry name `io.github.jbrandtmse/<bin>` on the five servers (and on nothing else);
 *  - the AD-28 deny-list: nothing in a name, description or keyword presents the suite as InterSystems' or endorsed;
 *  - the license text each package ships is a byte copy of the root `LICENSE`;
 *  - the documented Node floor: the root README states the manifest floor, and no document names Node 18 or 20.
 *
 * The package list is enumerated from the directory, never hand-typed, so a package added later is covered at once;
 * the expected roster is pinned separately so a package that appears or vanishes is a visible change (Rule #56).
 * This is a default-suite test (no IRIS, no build); Story 42.3 promotes it to a CI gate.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listScanSurface } from "../../../../scripts/lib/npx-pin-scan.mjs";
import { REPO_ROOT } from "./pack-fixture";

interface Manifest {
  name: string;
  description?: string;
  keywords?: unknown;
  homepage?: unknown;
  bugs?: { url?: unknown };
  license?: unknown;
  author?: unknown;
  repository?: { type?: unknown; url?: unknown; directory?: unknown };
  engines?: { node?: unknown; vscode?: unknown };
  mcpName?: unknown;
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, unknown>;
  publishConfig?: { exports?: Record<string, unknown> };
  files?: string[];
}

interface Entry {
  /** Repository-relative directory, e.g. `packages/shared`. */
  directory: string;
  manifest: Manifest;
  hasTsconfig: boolean;
}

function readManifest(directory: string): Manifest {
  return JSON.parse(readFileSync(join(REPO_ROOT, directory, "package.json"), "utf8")) as Manifest;
}

const PACKAGE_DIRECTORIES = readdirSync(join(REPO_ROOT, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(REPO_ROOT, "packages", entry.name, "package.json")))
  .map((entry) => `packages/${entry.name}`)
  .sort();
const EXTENSION_DIRECTORY = "extensions/iris-mcp-launcher";

const PACKAGES: Entry[] = PACKAGE_DIRECTORIES.map((directory) => ({
  directory,
  manifest: readManifest(directory),
  hasTsconfig: existsSync(join(REPO_ROOT, directory, "tsconfig.json")),
}));
const EXTENSION: Entry = { directory: EXTENSION_DIRECTORY, manifest: readManifest(EXTENSION_DIRECTORY), hasTsconfig: true };
const ROOT = readManifest(".");
const ALL_ENTRIES: Entry[] = [...PACKAGES, EXTENSION];

const REPOSITORY_URL = "git+https://github.com/jbrandtmse/iris-execute-mcp-v2.git";
const HOMEPAGE_BASE = "https://github.com/jbrandtmse/iris-execute-mcp-v2/tree/main";
const BUGS_URL = "https://github.com/jbrandtmse/iris-execute-mcp-v2/issues";
const SERVER_BINS = ["iris-admin-mcp", "iris-data-mcp", "iris-dev-mcp", "iris-interop-mcp", "iris-ops-mcp"];

const label = (entry: Entry): string => `${entry.manifest.name} (${entry.directory})`;
const declaredTypesNode = (manifest: Manifest): string | undefined =>
  manifest.devDependencies?.["@types/node"] ?? manifest.dependencies?.["@types/node"];

describe("the roster (Rule #56)", () => {
  it("is the eight published packages and nothing else", () => {
    expect(PACKAGES.map((entry) => entry.manifest.name).sort()).toEqual([
      "@iris-mcp/admin",
      "@iris-mcp/all",
      "@iris-mcp/client-config",
      "@iris-mcp/data",
      "@iris-mcp/dev",
      "@iris-mcp/interop",
      "@iris-mcp/ops",
      "@iris-mcp/shared",
    ]);
  });

  it("has seven TypeScript packages (a tsconfig.json), the meta-package being the only one without", () => {
    expect(PACKAGES.filter((entry) => entry.hasTsconfig)).toHaveLength(7);
    expect(PACKAGES.filter((entry) => !entry.hasTsconfig).map((entry) => entry.manifest.name)).toEqual(["@iris-mcp/all"]);
  });
});

describe("the Node floor (AC 42.1.1, AD-29)", () => {
  const FLOOR_PATTERN = /^>=22\.\d+\.\d+$/;
  const floor = ROOT.engines?.node;

  it("the root declares one >=22.x.y floor", () => {
    expect(floor).toMatch(FLOOR_PATTERN);
  });

  it.each(PACKAGES.map((entry) => [label(entry), entry] as const))("%s declares engines.node equal to the root floor", (_name, entry) => {
    expect(entry.manifest.engines?.node).toMatch(FLOOR_PATTERN);
    expect(entry.manifest.engines?.node).toBe(floor);
  });

  // The extension is exempt: VS Code runs it on the Node of its own Electron runtime, so `engines.vscode` governs its
  // floor, and a Node range would only describe a runtime nobody chooses. Story 42.7 owns the VSIX manifest.
  it("the extension is exempt from engines.node and declares engines.vscode instead", () => {
    expect(EXTENSION.manifest.engines?.vscode).toMatch(/^\^1\.\d+\.\d+$/);
  });
});

describe("@types/node (AC 42.1.1)", () => {
  const floorMajor = Number(/^>=(\d+)\./.exec(String(ROOT.engines?.node))?.[1]);

  it("the floor's major is 22", () => {
    expect(floorMajor).toBe(22);
  });

  it.each(ALL_ENTRIES.filter((entry) => entry.hasTsconfig).map((entry) => [label(entry), entry] as const))(
    "%s declares @types/node at the floor's major",
    (_name, entry) => {
      const declared = declaredTypesNode(entry.manifest);
      expect(declared, "@types/node must be declared").toBeDefined();
      expect(Number(/(\d+)\./.exec(String(declared))?.[1])).toBe(floorMajor);
    },
  );

  it("no package declares @types/node of another major, TypeScript or not", () => {
    for (const entry of ALL_ENTRIES) {
      const declared = declaredTypesNode(entry.manifest);
      if (declared !== undefined) expect(Number(/(\d+)\./.exec(declared)?.[1]), label(entry)).toBe(floorMajor);
    }
  });
});

describe("registry metadata (AC 42.1.5, DW-31)", () => {
  const holder = /^Copyright \(c\) \d{4} (.+)$/m.exec(readFileSync(join(REPO_ROOT, "LICENSE"), "utf8"))?.[1];

  it("the root LICENSE is the MIT License and names the holder", () => {
    expect(readFileSync(join(REPO_ROOT, "LICENSE"), "utf8").startsWith("MIT License")).toBe(true);
    expect(holder).toBe("jbrandtmse");
  });

  describe.each(ALL_ENTRIES.map((entry) => [label(entry), entry] as const))("%s", (_name, entry) => {
    const { manifest, directory } = entry;

    it("is MIT licensed", () => {
      expect(manifest.license).toBe("MIT");
    });

    it("names its repository and its own directory in it", () => {
      expect(manifest.repository?.type).toBe("git");
      // The packages carry npm's normalized `git+https` form; the extension's manifest (owned by Story 42.7) may use the plain URL.
      const url = String(manifest.repository?.url);
      expect(entry === EXTENSION ? url.replace(/^git\+/, "") : url).toBe(entry === EXTENSION ? REPOSITORY_URL.replace(/^git\+/, "") : REPOSITORY_URL);
      expect(manifest.repository?.directory).toBe(directory);
    });

    it("names the license holder as author, without an email", () => {
      expect(typeof manifest.author).toBe("string");
      const author = String(manifest.author);
      expect(author.startsWith(`${holder} (https://github.com/${holder})`)).toBe(true);
      expect(author).not.toMatch(/[<>@]/);
    });

    it("has a homepage, a bugs URL and non-empty keywords", () => {
      expect(manifest.homepage).toBe(`${HOMEPAGE_BASE}/${directory}#readme`);
      expect(manifest.bugs?.url).toBe(BUGS_URL);
      expect(Array.isArray(manifest.keywords)).toBe(true);
      const keywords = manifest.keywords as unknown[];
      expect(keywords.length).toBeGreaterThan(0);
      for (const keyword of keywords) expect(typeof keyword === "string" && keyword.trim() !== "").toBe(true);
    });
  });
});

describe("mcpName (AC 42.1.5, AD-29 decision #37)", () => {
  const servers = PACKAGES.filter((entry) => Object.keys(entry.manifest.bin ?? {}).some((bin) => SERVER_BINS.includes(bin)));

  it("the five servers are the packages whose bin is one of the five server commands", () => {
    expect(servers.map((entry) => Object.keys(entry.manifest.bin ?? {})[0]).sort()).toEqual(SERVER_BINS);
  });

  it.each(servers.map((entry) => [label(entry), entry] as const))("%s carries io.github.jbrandtmse/<bin>", (_name, entry) => {
    const bin = Object.keys(entry.manifest.bin ?? {})[0];
    expect(entry.manifest.mcpName).toBe(`io.github.jbrandtmse/${bin}`);
  });

  it("no other package carries an mcpName", () => {
    const withName = PACKAGES.filter((entry) => entry.manifest.mcpName !== undefined).map((entry) => entry.manifest.name);
    expect(withName.sort()).toEqual(servers.map((entry) => entry.manifest.name).sort());
  });
});

describe("AD-28 deny-list: nothing presents the suite as InterSystems' or endorsed", () => {
  const surfaces = (entry: Entry): Array<[string, string]> => [
    ["name", entry.manifest.name],
    ["description", entry.manifest.description ?? ""],
    ...((Array.isArray(entry.manifest.keywords) ? (entry.manifest.keywords as string[]) : []).map((keyword): [string, string] => ["keyword", keyword])),
  ];

  it.each([...ALL_ENTRIES, { directory: ".", manifest: ROOT, hasTsconfig: false }].map((entry) => [label(entry), entry] as const))(
    "%s",
    (_name, entry) => {
      for (const [field, text] of surfaces(entry)) {
        expect(text, `${field} says "official"`).not.toMatch(/\bofficial\b/i);
        expect(text, `${field} says "endorsed"`).not.toMatch(/\bendorsed\b/i);
        expect(text, `${field} says "by InterSystems"`).not.toMatch(/\bby\s+InterSystems\b/i);
      }
      expect(entry.manifest.description ?? "", "description starts with InterSystems").not.toMatch(/^\s*InterSystems/i);
      expect(entry.manifest.name, "name contains intersystems").not.toMatch(/intersystems/i);
    },
  );
});

describe("what a tarball may carry (the manifests behind AC 42.1.3)", () => {
  it("no package asks for vitest as a peer", () => {
    for (const entry of ALL_ENTRIES) {
      expect(entry.manifest.peerDependencies?.["vitest"], label(entry)).toBeUndefined();
      expect(entry.manifest.peerDependenciesMeta?.["vitest"], label(entry)).toBeUndefined();
    }
  });

  it("every built package keeps source maps out of its tarball", () => {
    for (const entry of PACKAGES.filter((candidate) => candidate.hasTsconfig)) {
      expect(entry.manifest.files, label(entry)).toContain("!dist/**/*.map");
    }
  });

  it("@iris-mcp/shared ships only its root export and keeps its test helpers out of dist", () => {
    const shared = PACKAGES.find((entry) => entry.manifest.name === "@iris-mcp/shared")?.manifest as Manifest;
    expect(Object.keys(shared.publishConfig?.exports ?? {})).toEqual(["."]);
    expect(shared.files).toContain("!dist/test-helpers");
  });
});

describe("the license text each package ships (AC 42.1.5)", () => {
  const rootLicense = readFileSync(join(REPO_ROOT, "LICENSE"), "utf8");

  it.each(ALL_ENTRIES.map((entry) => [label(entry), entry] as const))("%s ships a LICENSE that is a byte copy of the root LICENSE", (_name, entry) => {
    expect(readFileSync(join(REPO_ROOT, entry.directory, "LICENSE"), "utf8")).toBe(rootLicense);
  });
});

/** The documents' mentions of Node 18 or 20 as a supported runtime (`Node 18+`, `Node.js 20 or later`). */
const OLD_NODE_MENTION = /\bNode(?:\.js)?(?:\*\*|\]\([^)]*\))?\s*v?(?:18|20)(?!\d)/i;

describe("the documented Node floor (AC 42.1.1)", () => {
  const floor = /^>=(\d+\.\d+)\.\d+$/.exec(String(ROOT.engines?.node))?.[1] ?? "";

  it("the root README prerequisites and build requirement state the manifest floor", () => {
    const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
    expect(floor).toMatch(/^22\.\d+$/);
    expect(readme).toContain(`- **Node.js** ${floor} or later`);
    expect(readme).toContain(`[Node.js](https://nodejs.org/) ${floor}+`);
  });

  it("no document names Node 18 or 20 (the CHANGELOG history excepted)", () => {
    const documents = listScanSurface(REPO_ROOT).filter((file) => file.endsWith(".md") && !/(^|\/)CHANGELOG\.md$/.test(file));
    expect(documents).toContain("README.md");
    const mentions = documents.flatMap((file) =>
      readFileSync(join(REPO_ROOT, file), "utf8")
        .split("\n")
        .flatMap((text, index) => (OLD_NODE_MENTION.test(text) ? [`${file}:${index + 1}  ${text.trim()}`] : [])),
    );
    expect(mentions).toEqual([]);
  });

  it("the mention matcher flags Node 18 and 20 in the forms documents use, and passes the floor", () => {
    for (const text of ["Node.js 18 or later", "- **Node.js** 18+", "requires Node 20", "Node.js v20.1", "[Node.js](https://nodejs.org/) 18+"]) {
      expect(OLD_NODE_MENTION.test(text), text).toBe(true);
    }
    for (const text of ["Node.js 22.17 or later", "Node 22", "node:18-alpine is not used", "version 18.2 of the tool"]) {
      expect(OLD_NODE_MENTION.test(text), text).toBe(false);
    }
  });
});
