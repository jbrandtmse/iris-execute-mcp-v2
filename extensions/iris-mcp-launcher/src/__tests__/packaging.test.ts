/**
 * AC 31.4.1 / Task 6 packaging contract — a mismatch here is invisible to
 * every OTHER test file in this suite, since none of them ever read
 * package.json: all the fake-based unit tests exercise the pure logic
 * directly and would stay green even if package.json declared the wrong
 * `extensionDependencies`, a `main` that does not exist after build, or
 * `contributes.configuration` keys that no longer match what `settings.ts`
 * actually reads.
 *
 * Per Rule #51 ("a tally over a table is counted mechanically, never
 * hand-authored"), the configuration-key comparison below is DERIVED from
 * `settings.ts`'s source text via a regex over its `config.get(...)` calls,
 * not hand-copied — so adding a setting to one file without the other fails
 * this test immediately instead of silently drifting.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SERVER_MANAGER_EXTENSION_ID } from "../constants.js";
import { PACKAGE_DIR_NAME, PACKAGE_NPM_NAME } from "../definitions.js";
import { DEFAULT_PACKAGES } from "../settings.js";
import { stripComments } from "./sourceGrep.js";

// __dirname (not import.meta.url), matching containment.test.ts, so this file
// type-checks cleanly under the extension's own CommonJS tsconfig.json.
const ROOT = path.resolve(__dirname, "..", "..");
const SRC_DIR = path.join(ROOT, "src");

interface PackageJson {
  main: string;
  activationEvents: string[];
  extensionDependencies: string[];
  contributes: {
    configuration: { properties: Record<string, unknown> };
    commands: { command: string; title: string }[];
  };
}

/**
 * `tsconfig*.json` are JSONC — TypeScript allows `//` comments in them — so a
 * bare `JSON.parse` breaks the moment a config gains an explanatory comment.
 * Strip whole-line `//` comments (never an inline one, which could sit inside
 * a string value) before parsing.
 */
function readJson<T>(relativePath: string): T {
  const text = readFileSync(path.join(ROOT, relativePath), "utf8")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  return JSON.parse(text) as T;
}

describe("package.json packaging contract", () => {
  it("declares extensionDependencies on the Server Manager extension, pinned against the SAME runtime constant credentials.ts/extension.ts use — the two can never drift independently", () => {
    const pkg = readJson<PackageJson>("package.json");
    expect(pkg.extensionDependencies).toContain(SERVER_MANAGER_EXTENSION_ID);
  });

  it("main resolves to the file the build (tsconfig.build.json's rootDir/outDir mapping) actually produces from src/extension.ts — computed from tsconfig, not hand-copied", () => {
    const pkg = readJson<PackageJson>("package.json");
    const tsconfigBuild = readJson<{ extends: string }>("tsconfig.build.json");
    const tsconfig = readJson<{ compilerOptions: { outDir: string; rootDir: string } }>(
      "tsconfig.json",
    );

    expect(tsconfigBuild.extends).toBe("./tsconfig.json");
    const { outDir, rootDir } = tsconfig.compilerOptions;

    expect(existsSync(path.join(ROOT, rootDir, "extension.ts"))).toBe(true);
    expect(pkg.main).toBe(`./${outDir}/extension.js`);
  });

  it("main's compiled file exists whenever a build is present (skipped, not failed, on a pristine unbuilt checkout — the static path check above already covers that case deterministically)", () => {
    const pkg = readJson<PackageJson>("package.json");
    const mainPath = path.join(ROOT, pkg.main);
    if (!existsSync(path.join(ROOT, "dist"))) {
      return;
    }
    expect(existsSync(mainPath)).toBe(true);
  });

  it("contributes.configuration's declared setting keys EXACTLY match settings.ts's readSettings() keys (mechanically extracted from source, per Rule #51)", () => {
    const pkg = readJson<PackageJson>("package.json");
    const declaredKeys = Object.keys(pkg.contributes.configuration.properties)
      .map((key) => key.replace(/^irisMcpLauncher\./, ""))
      .sort();

    const settingsSource = readFileSync(path.join(ROOT, "src", "settings.ts"), "utf8");
    const readKeys = [...settingsSource.matchAll(/config\.get<[^>]+>\(\s*"([\w.]+)"/g)]
      .map((match) => match[1])
      .filter((key): key is string => key !== undefined)
      .sort();

    // Sanity: the regex actually matched something, so an empty-vs-empty
    // false pass (both sides accidentally [] ) cannot slip through.
    expect(readKeys.length).toBeGreaterThan(0);
    expect(declaredKeys).toEqual(readKeys);
  });

  /**
   * Story 31.6 (AC 31.6.5, Rule #51). The `packages` enum in
   * `contributes.configuration` and the `SuitePackageKey` union that
   * `readSettings`'s `isSuitePackageKey` filter enforces are two
   * hand-maintained lists that must agree, and Story 31.6 edited BOTH by hand
   * to remove `"all"`. Nothing previously compared them:
   *  - a key in the enum but not in the union is offered by the Settings UI
   *    and then silently filtered out at read time (exactly the `"all"`
   *    situation this story had to clean up);
   *  - a key in the union but not the enum is accepted by `readSettings` while
   *    the Settings UI marks it invalid.
   * `PACKAGE_NPM_NAME`/`PACKAGE_DIR_NAME` are keyed by `SuitePackageKey`, so
   * their key sets ARE the union at runtime — derived, not re-typed here.
   */
  it("contributes.configuration's packages enum EXACTLY matches the SuitePackageKey set the code accepts, and its default EXACTLY matches DEFAULT_PACKAGES (both derived, not re-typed)", () => {
    const pkg = readJson<{
      contributes: {
        configuration: {
          properties: Record<string, { items?: { enum?: string[] }; default?: unknown }>;
        };
      };
    }>("package.json");
    const packagesProperty = pkg.contributes.configuration.properties["irisMcpLauncher.packages"];

    const declaredEnum = [...(packagesProperty?.items?.enum ?? [])].sort();
    expect(declaredEnum.length).toBeGreaterThan(0);

    // Runtime source of truth for "which keys does the code accept".
    expect(declaredEnum).toEqual(Object.keys(PACKAGE_NPM_NAME).sort());
    // ...and the local-spawn map must cover exactly the same key set, so a
    // future package added to one map but not the other cannot ship.
    expect(Object.keys(PACKAGE_DIR_NAME).sort()).toEqual(declaredEnum);

    expect(packagesProperty?.default).toEqual([...DEFAULT_PACKAGES]);
  });

  /**
   * Story 31.6 code review. `irisMcpLauncher.developmentRepoPath` is the ONLY
   * setting in this extension that names a path the extension then EXECUTES
   * (`node <path>/packages/<dir>/dist/index.js`). Every other setting is inert
   * env pass-through or a server/package name. Without an explicit `scope`, a
   * VS Code setting defaults to `window`, which a workspace's own
   * `.vscode/settings.json` can set — so merely opening an untrusted folder
   * that carries a settings file plus a checked-in `dist/index.js` would hand
   * this extension an attacker-chosen executable. `machine` scope confines it
   * to the user's own User/Machine settings, which is what AC 31.6.4's stated
   * posture ("a checkout YOU trust") actually assumes. `machine-overridable`,
   * `resource` and `window` are all workspace-settable and must NOT appear here.
   */
  it("irisMcpLauncher.developmentRepoPath is machine-scoped, so a workspace's .vscode/settings.json can never choose which local binary this extension executes", () => {
    const pkg = readJson<{
      contributes: { configuration: { properties: Record<string, { scope?: string }> } };
    }>("package.json");

    expect(pkg.contributes.configuration.properties["irisMcpLauncher.developmentRepoPath"]?.scope).toBe(
      "machine",
    );
  });

  it("every declared configuration property has a 'default' matching readSettings()'s own fallback shape (array settings default to an array, string settings to a string, boolean settings to a boolean)", () => {
    const pkg = readJson<PackageJson>("package.json");
    const properties = pkg.contributes.configuration.properties as Record<
      string,
      { type: string; default: unknown }
    >;

    for (const [key, prop] of Object.entries(properties)) {
      if (prop.type === "array") {
        expect(
          Array.isArray(prop.default),
          `${key}: array-typed setting must default to an array`,
        ).toBe(true);
      } else if (prop.type === "boolean") {
        expect(typeof prop.default, `${key}: boolean-typed setting must default to a boolean`).toBe(
          "boolean",
        );
      } else if (prop.type === "string") {
        expect(typeof prop.default, `${key}: string-typed setting must default to a string`).toBe(
          "string",
        );
      }
    }
  });

  it("Story 31.5 AC 31.5.4: activationEvents includes onStartupFinished, so the status bar item appears on a plain window reload with MCP never exercised (not only when mcpServerDefinitionProviders is first asked)", () => {
    const pkg = readJson<PackageJson>("package.json");
    expect(pkg.activationEvents).toContain("onStartupFinished");
  });

  it("Task 5 / Rule #51: every declared contributes.commands id is registered via a *.registerCommand(...) call somewhere in src/*.ts (mechanically resolved through any exported string constant, never a hand-copied literal), and vice versa", () => {
    const pkg = readJson<PackageJson>("package.json");
    const declaredIds = pkg.contributes.commands.map((c) => c.command).sort();

    const sourceFiles = readdirSync(SRC_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => entry.name);

    // Resolve `registerCommand(SOME_CONSTANT, ...)` to SOME_CONSTANT's literal
    // value by scanning every `export const NAME = "..."` in src/*.ts first —
    // this test reads SOURCE TEXT only (no dynamic import), so an id passed
    // as an imported constant (this extension's actual style — see
    // `selectServers.ts`'s `SELECT_SERVERS_COMMAND_ID`) still resolves.
    // Comments are stripped first (code review, Story 31.5): this scan reads
    // raw source, so a `registerCommand("some.id")` written inside a doc
    // comment or a commented-out line would register a phantom id and flip
    // the strict `toEqual` below — a docs edit breaking a packaging test.
    const constValues = new Map<string, string>();
    for (const file of sourceFiles) {
      const text = stripComments(readFileSync(path.join(SRC_DIR, file), "utf8"));
      for (const match of text.matchAll(/export const (\w+)(?:\s*:\s*[^=]+)?\s*=\s*"([^"]+)"/g)) {
        const [, name, value] = match;
        if (name && value) constValues.set(name, value);
      }
    }

    const registeredIds = new Set<string>();
    for (const file of sourceFiles) {
      const text = stripComments(readFileSync(path.join(SRC_DIR, file), "utf8"));
      for (const match of text.matchAll(/registerCommand\(\s*(?:"([^"]+)"|(\w+))/g)) {
        const [, literal, identifier] = match;
        if (literal) {
          registeredIds.add(literal);
        } else if (identifier && constValues.has(identifier)) {
          registeredIds.add(constValues.get(identifier)!);
        }
      }
    }

    expect(declaredIds.length).toBeGreaterThan(0);
    expect([...registeredIds].sort()).toEqual(declaredIds);
  });
});

/**
 * `extension.ts` is the ONLY file with a value-level `import * as vscode`, so
 * no test can import it — every adapter in it (`toConfigurationTarget`,
 * `inspectServersConfig`/`updateServersConfig`, the status bar wiring, the
 * `onDidChangeConfiguration` filter, activation ORDER) is invisible to the
 * unit suite by construction, and the compiler cannot help either: all three
 * `ConfigurationTarget` members share one type, so a swapped mapping
 * type-checks cleanly. That gap is precisely where AC 31.5.2's named failure
 * mode ("must not silently write ... into user settings or vice versa") would
 * live.
 *
 * These are source-derived structural pins (Rule #51 — derived from disk, no
 * hand-rostered list) closing the mechanically-closable part of that gap. They
 * do NOT substitute for an Extension-Host test tier; see `deferred-work.md`
 * (item 31-5-1) and the Project Lead's per-story manual smoke, which remains
 * the compensating control for everything genuinely runtime-only.
 */
describe("extension.ts wiring — structural pins for the adapters no unit test can import (code review, Story 31.5)", () => {
  const extensionCode = stripComments(readFileSync(path.join(SRC_DIR, "extension.ts"), "utf8"));
  const selectServersCode = stripComments(
    readFileSync(path.join(SRC_DIR, "selectServers.ts"), "utf8"),
  );

  it("toConfigurationTarget maps every ConfigWriteTarget member onto the SAME-NAMED vscode.ConfigurationTarget member — a swap (e.g. \"workspace\" -> Global) type-checks fine and would write the user's pick to the wrong file", () => {
    const pairs = [
      ...extensionCode.matchAll(/case\s+"(\w+)":\s*return\s+vscode\.ConfigurationTarget\.(\w+);/g),
    ].map((match) => ({ local: match[1]!, target: match[2]! }));

    expect(pairs.length).toBeGreaterThan(0);
    for (const { local, target } of pairs) {
      expect(target.toLowerCase(), `case "${local}" must map to ConfigurationTarget.${local}`).toBe(
        local.toLowerCase(),
      );
    }

    // ...and the mapped set is EXACTLY the ConfigWriteTarget union, extracted
    // from selectServers.ts's source — so adding a union member without a
    // mapping case (or leaving a case for a removed member) fails here.
    const union = /export type ConfigWriteTarget =([^;]+);/.exec(selectServersCode);
    expect(union, "ConfigWriteTarget union not found in selectServers.ts").not.toBeNull();
    const members = [...union![1]!.matchAll(/"(\w+)"/g)].map((match) => match[1]!).sort();
    expect(members.length).toBeGreaterThan(0);
    expect(pairs.map((p) => p.local).sort()).toEqual(members);
  });

  it("irisMcpLauncher.servers declares no folder-writable `scope`, which is WHY ConfigWriteTarget has no workspaceFolder member — adding `\"scope\": \"resource\"` here without revisiting resolveWriteTarget/getConfiguration would silently reintroduce the dead branch", () => {
    const pkg = readJson<{
      contributes: { configuration: { properties: Record<string, { scope?: string }> } };
    }>("package.json");
    const declaredScope = pkg.contributes.configuration.properties["irisMcpLauncher.servers"]?.scope;

    // Absent === VS Code's default `window` scope, which folder settings
    // cannot carry (see the update() @throws oracle quoted in
    // selectServers.test.ts). `resource`/`language-overridable`/
    // `machine-overridable` ARE folder-writable and would invalidate the
    // union below.
    expect(["window", "application", "machine", undefined]).toContain(declaredScope);
    expect(selectServersCode).not.toMatch(/"workspaceFolder"/);
  });

  it("the selectServers command and the status bar item are registered BEFORE the MCP provider, so a registerMcpServerDefinitionProvider failure cannot take the zero-state signal (AC 31.5.3/31.5.4) down with it", () => {
    const commandAt = extensionCode.indexOf("registerCommand(");
    const statusBarAt = extensionCode.indexOf("createStatusBarItem(");
    const mcpAt = extensionCode.indexOf("registerMcpServerDefinitionProvider(");

    expect(commandAt).toBeGreaterThan(-1);
    expect(statusBarAt).toBeGreaterThan(-1);
    expect(mcpAt).toBeGreaterThan(-1);
    expect(commandAt).toBeLessThan(mcpAt);
    expect(statusBarAt).toBeLessThan(mcpAt);
  });

  it("the status bar item's click action is the command constant (not a hand-copied literal) and the config listener is filtered to CONFIG_SECTION, so the AC 31.5.3 refresh cannot fire on unrelated settings or point at a stale id", () => {
    expect(extensionCode).toMatch(/statusBarItem\.command\s*=\s*SELECT_SERVERS_COMMAND_ID/);
    expect(extensionCode).toMatch(/affectsConfiguration\(CONFIG_SECTION\)/);
    expect(extensionCode).toMatch(/onDidChangeConfiguration\(/);
  });
});
