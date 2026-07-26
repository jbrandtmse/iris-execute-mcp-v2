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
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SERVER_MANAGER_EXTENSION_ID } from "../constants.js";

// __dirname (not import.meta.url), matching containment.test.ts, so this file
// type-checks cleanly under the extension's own CommonJS tsconfig.json.
const ROOT = path.resolve(__dirname, "..", "..");

interface PackageJson {
  main: string;
  extensionDependencies: string[];
  contributes: { configuration: { properties: Record<string, unknown> } };
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
});
