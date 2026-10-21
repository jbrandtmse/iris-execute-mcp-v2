/**
 * Story 42.1 QA (AC 42.1.2; Rule #51, Rule #56) - the commands a project install of `@iris-mcp/all` links are counted from the
 * manifests, never from the prose.
 *
 * `@iris-mcp/all` has no `bin`, so a global install links nothing; an npm project install links the `bin` entries of its
 * dependencies, and of THEIR `@iris-mcp/*` dependencies (the two commands of `@iris-mcp/shared` arrive through the servers).
 * pnpm links only the commands of a project's direct dependencies, so the documents name npm.
 * The meta-package README names those commands and says how many there are, and the root README repeats the count. This test
 * derives the set from the manifests and pins both documents to it, so a new bin, a renamed command, or a dependency that
 * changes the set makes the correction wrong visibly.
 *
 * A default-suite test (no IRIS, no build).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./pack-fixture";

interface Manifest {
  name: string;
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
}

const NUMBER_WORDS: Record<number, string> = { 1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten" };

const MANIFESTS = new Map<string, Manifest>(
  readdirSync(join(REPO_ROOT, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(REPO_ROOT, "packages", entry.name, "package.json")))
    .map((entry) => JSON.parse(readFileSync(join(REPO_ROOT, "packages", entry.name, "package.json"), "utf8")) as Manifest)
    .map((manifest) => [manifest.name, manifest] as const),
);

/** Every command an npm project install of `@iris-mcp/all` puts in `node_modules/.bin`: the bins of its `@iris-mcp/*` dependencies, transitively. */
function linkedCommands(): string[] {
  const commands = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string): void => {
    if (visited.has(name)) return;
    visited.add(name);
    const manifest = MANIFESTS.get(name);
    if (manifest === undefined) throw new Error(`${name} is a dependency in the chain but not a package of this repository`);
    for (const bin of Object.keys(manifest.bin ?? {})) commands.add(bin);
    for (const dependency of Object.keys(manifest.dependencies ?? {})) if (dependency.startsWith("@iris-mcp/")) visit(dependency);
  };
  for (const dependency of Object.keys(MANIFESTS.get("@iris-mcp/all")?.dependencies ?? {})) visit(dependency);
  return [...commands].sort();
}

const squash = (text: string): string => text.replace(/\s+/g, " ");

describe("the commands a project install of @iris-mcp/all links", () => {
  const commands = linkedCommands();

  it("are the five servers' commands and the two commands of @iris-mcp/shared", () => {
    expect(commands).toEqual([
      "iris-admin-mcp",
      "iris-data-mcp",
      "iris-dev-mcp",
      "iris-interop-mcp",
      "iris-mcp-credentials",
      "iris-mcp-governance",
      "iris-ops-mcp",
    ]);
  });

  it("the meta-package README names exactly those commands and counts them", () => {
    const text = squash(readFileSync(join(REPO_ROOT, "packages/iris-mcp-all/README.md"), "utf8"));
    const sentence = /An npm project install links the (\w+) commands of its dependencies into `node_modules\/\.bin`: (.*?) A \*\*global\*\* install/.exec(text);
    expect(sentence, "the project-install sentence is missing or reworded").not.toBeNull();
    expect(sentence?.[1]).toBe(NUMBER_WORDS[commands.length]);
    const named = [...(sentence?.[2] ?? "").matchAll(/`([a-z-]+)`/g)].map((match) => match[1] as string).sort();
    expect(named).toEqual(commands);
  });

  it("the root README and the install comment repeat the same count", () => {
    const root = squash(readFileSync(join(REPO_ROOT, "README.md"), "utf8"));
    const rootClaim = `an npm project install puts the ${NUMBER_WORDS[commands.length]} commands of its dependencies in \`node_modules/.bin\``;
    expect(root.includes(rootClaim), `README.md must say: ${rootClaim}`).toBe(true);
    const meta = squash(readFileSync(join(REPO_ROOT, "packages/iris-mcp-all/README.md"), "utf8"));
    const metaClaim = `puts the ${NUMBER_WORDS[commands.length]} commands of the dependencies in node_modules/.bin`;
    expect(meta.includes(metaClaim), `packages/iris-mcp-all/README.md must say: ${metaClaim}`).toBe(true);
  });

  it("the meta-package itself links none: it has no bin", () => {
    expect(MANIFESTS.get("@iris-mcp/all")?.bin).toBeUndefined();
  });
});
