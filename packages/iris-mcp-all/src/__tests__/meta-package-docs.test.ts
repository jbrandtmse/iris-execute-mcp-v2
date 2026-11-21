/**
 * Story 42.1 (AC 42.1.2; Rule #56, Rule #59) - no document claims that `@iris-mcp/all` links or launches a command.
 *
 * `@iris-mcp/all` is a dependencies-only meta-package with no `bin`: `npm i -g @iris-mcp/all` links nothing into
 * `<prefix>/bin`, and `npx -y @iris-mcp/all` has nothing to run. This pins
 *  1. the manifest fact the documents rest on (no `bin`, no `main`, the five servers as dependencies);
 *  2. the two places that tell a reader what a global install does (the meta-package README and the root README): each says
 *     a global install links no command and points to the per-server `npx -y @iris-mcp/<server>@1`;
 *  3. a sweep of every document and source file the npx-pin scan reads: none calls the package an aggregate server, runs it
 *     through `npx`, or recommends a global install without saying it links no command. The dated `claude mcp list`
 *     captures of the certification record are exempt (captured evidence is never rewritten).
 * The sweep's own checker is run on synthetic text, so it is proven able to fail. A default-suite test (no IRIS, no build).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listScanSurface, PIN_TOOLING_FILES } from "../../../../scripts/lib/npx-pin-scan.mjs";
import { REPO_ROOT } from "./pack-fixture";

const read = (relative: string): string => readFileSync(join(REPO_ROOT, relative), "utf8");
const squash = (text: string): string => text.replace(/\s+/g, " ");

/** A line that states the negative (the package cannot be run) may name the spec it cannot run. */
const NEGATION = /\b(?:never|cannot|can't|could not)\b|\bno (?:`?bin`?|executable)\b/i;
/** The dated verbatim `claude mcp list` captures of the certification record. */
const CAPTURED_EVIDENCE = /claude mcp list/;
const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/\baggregate stdio server\b/i, "calls @iris-mcp/all an aggregate stdio server"],
  [/\bhand-?write the aggregate\b/i, "tells users to hand-write an aggregate entry"],
  [/@iris-mcp\/all[^\n]{0,80}\b(?:single|one) command\b/i, "says @iris-mcp/all installs everything with one command"],
  [/\b(?:single|one) command[^\n]{0,80}@iris-mcp\/all/i, "says one command installs @iris-mcp/all"],
];
const RUNS_THROUGH_NPX = [
  /\bnpx\s+(?:(?:-y|--yes)\s+)*@iris-mcp\/all(?![\w/-])/,
  /"-y",\s*"@iris-mcp\/all(?:@[^"]*)?"/,
];
/**
 * A global install of the meta-package, in the forms npm, pnpm and yarn take: `-g` or `--global` before or after the package
 * (only other flags in between), `npm -g install`, and `yarn global add`.
 */
const GLOBAL_INSTALL = [
  /\b(?:install|i|add)\s+(?:-\S+\s+)*?(?:-g|--global)\s+(?:-\S+\s+)*@iris-mcp\/all\b/,
  /\b(?:install|i|add)\s+(?:-\S+\s+)*@iris-mcp\/all\b(?:\s+-\S+)*?\s+(?:-g|--global)\b/,
  /\b(?:-g|--global)\s+(?:install|i|add)\s+(?:-\S+\s+)*@iris-mcp\/all\b/,
  /\byarn\s+global\s+add\s+(?:-\S+\s+)*@iris-mcp\/all\b/,
];

/** Everything in `text` that claims `@iris-mcp/all` links or launches a command. */
function metaPackageProblems(text: string): string[] {
  const problems: string[] = [];
  text.split("\n").forEach((line, index) => {
    if (CAPTURED_EVIDENCE.test(line)) return;
    for (const [pattern, what] of FORBIDDEN) if (pattern.test(line)) problems.push(`line ${index + 1}: ${what}`);
    if (RUNS_THROUGH_NPX.some((pattern) => pattern.test(line)) && !NEGATION.test(line)) {
      problems.push(`line ${index + 1}: runs @iris-mcp/all through npx without saying it cannot start`);
    }
  });
  for (const paragraph of text.split(/\n\s*\n/)) {
    if (GLOBAL_INSTALL.some((pattern) => pattern.test(squash(paragraph))) && !/\bno command\b/i.test(squash(paragraph))) {
      problems.push("a paragraph installs @iris-mcp/all globally without saying it links no command");
    }
  }
  return problems;
}

describe("the manifest fact the documents rest on", () => {
  const manifest = JSON.parse(read("packages/iris-mcp-all/package.json")) as {
    bin?: unknown;
    main?: unknown;
    dependencies?: Record<string, string>;
  };

  it("@iris-mcp/all has no bin and no main", () => {
    expect(manifest.bin).toBeUndefined();
    expect(manifest.main).toBeUndefined();
  });

  it("it depends on exactly the five servers", () => {
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      "@iris-mcp/admin",
      "@iris-mcp/data",
      "@iris-mcp/dev",
      "@iris-mcp/interop",
      "@iris-mcp/ops",
    ]);
  });
});

describe("the two places that describe a global install", () => {
  it("the meta-package README says a global install links no command and points to the per-server npx form", () => {
    const text = squash(read("packages/iris-mcp-all/README.md"));
    expect(text).toContain("It launches nothing and links no command.");
    expect(text).toContain("A **global** install (`npm install -g @iris-mcp/all`) links no command at all");
    expect(text).toContain("An npm project install links the seven commands of its dependencies into `node_modules/.bin`");
    expect(text).toContain("`npx -y @iris-mcp/<server>@1`");
    expect(text).toContain("It is not a server and cannot be started");
  });

  it("the root README says the same under the meta-package heading", () => {
    const readme = read("README.md");
    const start = readme.indexOf("### Meta-package");
    expect(start).toBeGreaterThan(-1);
    const section = squash(readme.slice(start, readme.indexOf("\n---", start)));
    expect(section).toContain("it launches nothing");
    expect(section).toContain("a global install (`npm install -g @iris-mcp/all`) links no command");
    expect(section).toContain("`npx -y @iris-mcp/<server>@1`");
  });
});

describe("no document or source claims @iris-mcp/all links or launches a command", () => {
  it("the sweep finds nothing on the npx-pin scan surface (the CHANGELOG history excepted)", () => {
    const surface = listScanSurface(REPO_ROOT).filter((file) => !/(^|\/)CHANGELOG\.md$/.test(file) && !PIN_TOOLING_FILES.test(file));
    expect(surface).toContain("README.md");
    expect(surface).toContain("packages/iris-mcp-all/README.md");
    expect(surface).toContain("packages/client-config/src/types.ts");
    const problems = surface.flatMap((file) => metaPackageProblems(read(file)).map((problem) => `${file}: ${problem}`));
    expect(problems).toEqual([]);
  });

  it("the checker rejects each form of the old claim and accepts the corrected prose", () => {
    expect(metaPackageProblems("`iris-mcp-all` is a real aggregate stdio server.")).toHaveLength(1);
    expect(metaPackageProblems("Users hand-write the aggregate if they want it.")).toHaveLength(1);
    expect(metaPackageProblems("`@iris-mcp/all` installs all five servers with a single command.")).toHaveLength(1);
    expect(metaPackageProblems("Run `npx -y @iris-mcp/all@1` to start everything.")).toHaveLength(1);
    expect(metaPackageProblems('"args": ["-y", "@iris-mcp/all"],')).toHaveLength(1);
    expect(metaPackageProblems("Once published, install it with `npm install -g @iris-mcp/all`.")).toHaveLength(1);
    expect(metaPackageProblems("Install everything: `npm i -g @iris-mcp/all`.")).toHaveLength(1);
    expect(metaPackageProblems("Install everything: `npm install --global @iris-mcp/all`.")).toHaveLength(1);
    expect(metaPackageProblems("Install everything: `npm install @iris-mcp/all -g`.")).toHaveLength(1);
    expect(metaPackageProblems("Install everything: `pnpm add -g @iris-mcp/all`.")).toHaveLength(1);
    expect(metaPackageProblems("Install everything: `yarn global add @iris-mcp/all`.")).toHaveLength(1);
    expect(metaPackageProblems("Install a server: npm install -g @iris-mcp/dev; @iris-mcp/all is a meta-package.")).toEqual([]);

    expect(metaPackageProblems("`npx -y @iris-mcp/all@1` could never start a server.")).toEqual([]);
    expect(metaPackageProblems("`npx -y @iris-mcp/all@1` has no executable to run.")).toEqual([]);
    expect(metaPackageProblems("A global install (`npm install -g @iris-mcp/all`) links no command.")).toEqual([]);
    expect(metaPackageProblems("claude mcp list showed: iris-mcp-all: npx -y @iris-mcp/all - Pending approval")).toEqual([]);
    expect(metaPackageProblems("Start a server with `npx -y @iris-mcp/dev@1`; `@iris-mcp/all` is not needed.")).toEqual([]);
  });
});
